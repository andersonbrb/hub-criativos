import { atenderMcp, mcpSoAceitaPost } from "@/features/conector/servicos/mcp";

// Servidor MCP público do Hub (o "Conector do Hub" do Claude Code e do claude.ai), com login OAuth por pessoa.
// Só POST, sem estado; autentica só pelo token Bearer. Lógica em features/conector/servicos/mcp.ts.
// Não confundir com /api/mcp, que é o conector interno do cérebro local do chat.
export async function POST(request: Request) {
  return atenderMcp(request);
}

export async function GET() {
  return mcpSoAceitaPost();
}

export async function DELETE() {
  return mcpSoAceitaPost();
}
