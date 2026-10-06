import { runFlora } from "@/lib/server/actions";
import { route } from "@/lib/server/http";

// FormData: family, prompt, params (JSON), count, operation, market e as referências:
//           referenceId (gerações do hub, pode repetir) e image (arquivos, pode repetir).
// Com mais de uma referência, o modelo precisa ter versão de várias imagens (fromImages em lib/flora-models.ts).
export const POST = route(async (request: Request) => {
  const form = await request.formData();
  const generations = await runFlora({
    family: String(form.get("family") ?? ""),
    prompt: String(form.get("prompt") ?? ""),
    params: JSON.parse(String(form.get("params") ?? "{}")),
    count: Number(form.get("count")),
    operation: String(form.get("operation") ?? ""),
    market: String(form.get("market") ?? ""),
    referenceIds: form.getAll("referenceId").map(String).filter(Boolean),
    images: form.getAll("image").filter((f): f is File => f instanceof File && f.size > 0),
  });
  return Response.json({ generations });
});
