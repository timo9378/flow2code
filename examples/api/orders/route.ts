import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const CreateOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  couponCode: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await rateLimit.limit(ip);
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { productId, quantity, couponCode } = parsed.data;

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || product.stock < quantity) {
    return NextResponse.json({ error: "Out of stock" }, { status: 409 });
  }

  let discount = 0;
  if (couponCode) {
    const coupon = await db.coupon.findUnique({ where: { code: couponCode } });
    if (coupon && coupon.expiresAt > new Date()) {
      discount = coupon.percentOff;
    }
  }

  const total = Math.round(product.price * quantity * (1 - discount / 100));

  const order = await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: { stock: { decrement: quantity } },
    });
    return tx.order.create({
      data: { productId, quantity, total, status: "PENDING" },
    });
  });

  return NextResponse.json({ orderId: order.id, total }, { status: 201 });
}
