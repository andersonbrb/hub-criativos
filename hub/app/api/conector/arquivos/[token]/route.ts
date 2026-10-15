import { entregarDownload, receberEnvio } from "@/features/conector/servicos/links";

// Links curtos do conector para o terminal (curl). Rota pública: o token do link é a credencial, e o dono do link é
// reconferido a cada uso. PUT = envio (curl -T, uso único); GET = download (curl -o, pode repetir no prazo).
// Lógica em features/conector/servicos/links.ts.

type Contexto = { params: Promise<{ token: string }> };

export async function PUT(request: Request, { params }: Contexto) {
  return receberEnvio(request, (await params).token);
}

export async function GET(_request: Request, { params }: Contexto) {
  return entregarDownload((await params).token);
}
