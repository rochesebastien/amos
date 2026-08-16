// State machine of an order: cart -> shipping -> payment -> confirmed.
export type OrderState = "cart" | "shipping" | "payment" | "confirmed";

const NEXT: Record<OrderState, OrderState | null> = {
  cart: "shipping",
  shipping: "payment",
  payment: "confirmed",
  confirmed: null,
};

export function advance(state: OrderState): OrderState {
  const next = NEXT[state];
  if (!next) throw new Error(`order is already ${state}`);
  return next;
}
