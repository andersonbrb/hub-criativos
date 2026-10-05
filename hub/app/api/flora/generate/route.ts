import { runFlora } from "@/lib/server/actions";
import { route } from "@/lib/server/http";

// FormData: family, prompt, params (JSON), count, operation, market,
//           e no máximo UMA referência: referenceId (geração do hub) ou image (arquivo).
// Playbook COD: uma referência só (a foto do produto); duas enfraquecem o produto.
export const POST = route(async (request: Request) => {
  const form = await request.formData();
  const image = form.get("image");
  const generations = await runFlora({
    family: String(form.get("family") ?? ""),
    prompt: String(form.get("prompt") ?? ""),
    params: JSON.parse(String(form.get("params") ?? "{}")),
    count: Number(form.get("count")),
    operation: String(form.get("operation") ?? ""),
    market: String(form.get("market") ?? ""),
    referenceId: String(form.get("referenceId") ?? ""),
    image: image instanceof File ? image : null,
  });
  return Response.json({ generations });
});
