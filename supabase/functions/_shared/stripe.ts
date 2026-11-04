import Stripe from 'npm:stripe@17.7.0';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
});

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export { adminClient, corsHeaders, isAllowedOrigin, json, userClient } from './http.ts';
