import "server-only";

import type { AgentSettings } from "@/lib/server/agent-settings";

// Versão da personalização para a tela: cada arquivo com a URL para prévia/download.
export const mediaUrlOf = (s: AgentSettings) => ({ ...s, files: s.files.map((f) => ({ ...f, url: `/api/media/${f.file}` })) });
