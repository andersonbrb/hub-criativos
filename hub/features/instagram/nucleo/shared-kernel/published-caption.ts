/**
 * Texto exato que vai ao ar no Instagram: legenda, uma linha em branco e as hashtags
 * com um único `#`. A governança mede este texto e a publicação envia este texto.
 */
export function composePublishedCaption(caption: string, hashtags: readonly string[]): string {
  const block = hashtags
    .map((tag) => tag.trim().replace(/^#+/, ''))
    .filter((tag) => tag.length > 0)
    .map((tag) => `#${tag}`)
    .join(' ');
  return block ? `${caption}\n\n${block}` : caption;
}
