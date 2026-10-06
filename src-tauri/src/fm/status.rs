//! Model availability, license status, macOS version.

use serde::Serialize;
use std::process::Stdio;

/// Everything the Setup page checks.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FmStatus {
    pub binary_path: String,
    pub binary_found: bool,
    pub macos_version: String,
    pub macos_build: String,
    pub model_available: bool,
    /// Raw message from `fm available`, e.g. "System model available".
    pub availability_message: String,
    pub license_agreed: bool,
    /// Raw message from `fm license --status`.
    pub license_message: String,
    /// From config (the CLI does not print it outside `fm chat`).
    pub context_size: u32,
}

/// Runs `fm available`, `fm license --status` and `sw_vers` in parallel.
pub async fn check(fm_path: &str, context_size: u32) -> FmStatus {
    let mut status = FmStatus { binary_path: fm_path.to_string(), context_size, ..Default::default() };

    let os = async { tokio::join!(sw_vers("-productVersion"), sw_vers("-buildVersion")) };
    if !is_executable(fm_path) {
        let (version, build) = os.await;
        status.macos_version = version;
        status.macos_build = build;
        status.availability_message = if std::path::Path::new(fm_path).exists() {
            format!("The file at {fm_path} is not a program fm can run. Check the fm path in Settings.")
        } else {
            format!("fm was not found at {fm_path}. fm comes with macOS 27 or later. Check the fm path in Settings.")
        };
        status.license_message = "Cannot check the license because fm was not found.".into();
        return status;
    }
    status.binary_found = true;

    let available_args = vec!["available".to_string()];
    let license_args = vec!["license".to_string(), "--status".to_string()];
    let ((version, build), available, license) =
        tokio::join!(os, super::run_collect(fm_path, &available_args), super::run_collect(fm_path, &license_args),);
    status.macos_version = version;
    status.macos_build = build;

    match available {
        Ok(r) => {
            let message = output_message(&r);
            let lower = message.to_lowercase();
            status.model_available = r.exit_code == 0 && lower.contains("available") && !lower.contains("unavailable");
            status.availability_message = message;
        }
        Err(err) => status.availability_message = err,
    }
    match license {
        Ok(r) => {
            let message = output_message(&r);
            status.license_agreed = message.starts_with("Agreed");
            status.license_message = message;
        }
        Err(err) => status.license_message = err,
    }
    status
}

/// The text a status command printed: stdout, else the error, else stderr.
fn output_message(r: &super::RunResult) -> String {
    let out = r.stdout.trim();
    if !out.is_empty() {
        return out.to_string();
    }
    if let Some(err) = &r.error {
        return err.clone();
    }
    crate::util::clean_fm_error(&r.stderr)
}

fn is_executable(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

async fn sw_vers(flag: &str) -> String {
    let run = tokio::process::Command::new("/usr/bin/sw_vers")
        .arg(flag)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(std::time::Duration::from_secs(10), run).await {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_binary_gives_helpful_status() {
        let s = check("/nonexistent/fm", 4096).await;
        assert!(!s.binary_found);
        assert!(!s.model_available);
        assert!(!s.license_agreed);
        assert_eq!(s.context_size, 4096);
        assert!(s.availability_message.contains("was not found"));
        assert!(!s.macos_version.is_empty(), "sw_vers should work on macOS");
    }

    #[tokio::test]
    async fn reads_fake_fm_output() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fm");
        std::fs::write(
            &path,
            "#!/bin/sh\nif [ \"$1\" = available ]; then echo 'System model unavailable: not ready'; exit 1; fi\n\
             echo 'Agreed to license FM1 version 1.0'\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let s = check(path.to_str().unwrap(), 8192).await;
        assert!(s.binary_found);
        assert!(!s.model_available);
        assert_eq!(s.availability_message, "System model unavailable: not ready");
        assert!(s.license_agreed);
    }
}
