import "server-only";

// Erro dos endpoints /oauth2/token e /oauth2/revoke, no formato da RFC 6749 §5.2 ({ error, error_description }).
// Os códigos são os da RFC (em inglês, é o que o cliente OAuth entende); a descrição é em português.
export class ErroOAuth extends Error {
  constructor(
    public codigo: string,
    public descricao: string,
    public status = 400,
  ) {
    super(descricao);
  }
}

// Erro de ferramenta do MCP: vira resultado com isError: true, e o modelo lê o texto para corrigir a próxima chamada.
export class ErroDaFerramenta extends Error {}

// Parâmetro inválido na própria mensagem JSON-RPC (não nos argumentos de uma ferramenta): vira -32602.
export class ErroDeParametro extends Error {}
