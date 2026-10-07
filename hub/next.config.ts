import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Esconde o botão "N" do Next no canto da tela (erros de compilação/execução continuam aparecendo).
  devIndicators: false,
  experimental: {
    // Com o proxy (senha do hub na nuvem), o Next só repassa os primeiros 10 MB de cada envio: anexos maiores
    // (vídeo, música, várias fotos) chegavam cortados e davam "Failed to parse body as FormData".
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
