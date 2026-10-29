declare const brand: unique symbol;

/** Tipo nominal: impede trocar um `MarketId` por um `ChannelId` por engano. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
