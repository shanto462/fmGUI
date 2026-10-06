//! Model availability, license status, macOS version.
//! OWNER: agent "cli".

use serde::Serialize;

/// CONTRACT
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

/// CONTRACT
pub async fn check(fm_path: &str, context_size: u32) -> FmStatus {
    FmStatus { binary_path: fm_path.to_string(), context_size, ..Default::default() }
}
