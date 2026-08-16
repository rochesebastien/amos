/** Charge a card. Amounts are integer cents; never floats. */
export async function charge(amountCents: number, customerId: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("amount must be a positive integer of cents");
  }
  return { id: `ch_${customerId}_${amountCents}`, status: "succeeded" as const };
}
