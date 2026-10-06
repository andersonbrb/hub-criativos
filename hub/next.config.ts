import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Esconde o botão "N" do Next no canto da tela (erros de compilação/execução continuam aparecendo).
  devIndicators: false,
};

export default nextConfig;
