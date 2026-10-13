import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { InputError } from "@/lib/server/http";
import { mcp } from "@/lib/server/mcp-client";

// MCP remoto do HeyGen (mcp.heygen.com) com login OAuth da conta: tradução, criar avatar, avatares, vozes e vídeos.
// O cliente genérico (login, tokens, protocolo) fica em lib/server/mcp-client.ts; aqui só o que é do HeyGen.

const heygen = mcp("heygen");

export const connectionStatus = heygen.connectionStatus;
export const startLogin = heygen.startLogin;
export const finishLogin = heygen.finishLogin;
export const disconnect = heygen.disconnect;
export const callTool = heygen.callTool;

// Sobe um arquivo do hub para o HeyGen (upload direto ao S3 assinado pelo MCP) e devolve o asset_id.
export async function uploadAsset(filePath: string, fileKey: string, contentType: string): Promise<string> {
  const cached = await heygen.cachedAsset(fileKey);
  if (cached) return cached;
  const bytes = await readFile(filePath);
  const up = await callTool<{ asset_id: string; upload_url: string; upload_headers?: Record<string, string>; max_bytes?: number }>("create_asset_upload", {
    filename: path.basename(filePath),
    contentType,
    sizeBytes: bytes.length,
  });
  if (up.max_bytes && bytes.length > up.max_bytes) throw new InputError(`Arquivo grande demais para o HeyGen (máx. ${Math.round(up.max_bytes / 1024 / 1024)} MB).`);
  const put = await fetch(up.upload_url, { method: "PUT", headers: { "content-type": contentType, ...up.upload_headers }, body: bytes });
  if (!put.ok) throw new Error(`Falhou o envio do arquivo ao HeyGen (${put.status}).`);
  await callTool("complete_asset_upload", { assetId: up.asset_id });
  await heygen.rememberAsset(fileKey, up.asset_id);
  return up.asset_id;
}
