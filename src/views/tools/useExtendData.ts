import { useCallback, useEffect, useState } from "react";
import { errorMessage, skillsList, toolsCatalog } from "../../lib/api";
import type { Skill, ToolInfo } from "../../lib/types";

/** Loads the tool catalog and the skill list, for pages that show the context budget. */
export function useExtendData() {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Never rejects: each list keeps its own error.
  const fetchAll = useCallback(
    () =>
      Promise.allSettled([toolsCatalog(), skillsList()]).then(([t, s]) => {
        if (t.status === "fulfilled") {
          setTools(t.value);
          setToolsError(null);
        } else {
          setToolsError(errorMessage(t.reason));
          setTools((prev) => prev ?? []);
        }
        if (s.status === "fulfilled") {
          setSkills(s.value);
          setSkillsError(null);
        } else {
          setSkillsError(errorMessage(s.reason));
          setSkills((prev) => prev ?? []);
        }
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const reload = useCallback(() => {
    setLoading(true);
    return fetchAll();
  }, [fetchAll]);

  return { tools, setTools, skills, toolsError, skillsError, loading, reload };
}
