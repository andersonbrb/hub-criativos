// Endereços dos aplicativos das ferramentas conectadas ao hub (botões "Abrir no …").

export type AppId = "flora" | "elevenlabs" | "heygen" | "higgsfield" | "anthropic" | "venice";

export const APPS: Record<AppId, { name: string; url: string }> = {
  flora: { name: "FLORA", url: "https://app.flora.ai/projects" },
  elevenlabs: { name: "ElevenLabs", url: "https://elevenlabs.io/app/home" },
  heygen: { name: "HeyGen", url: "https://app.heygen.com/home" },
  higgsfield: { name: "Higgsfield", url: "https://higgsfield.ai" },
  anthropic: { name: "Claude Console", url: "https://platform.claude.com" },
  venice: { name: "Venice", url: "https://venice.ai/chat" },
};
