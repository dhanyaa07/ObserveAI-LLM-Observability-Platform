import { NextResponse } from "next/server";
import { seedInitialData } from "@/db/seed";

export async function GET() {
  try {
    await seedInitialData();
    return NextResponse.json({ success: true, message: "Database verified & seeded successfully" });
  } catch (error: any) {
    console.error("Seed error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    await seedInitialData();
    return NextResponse.json({ success: true, message: "Database re-seeded successfully" });
  } catch (error: any) {
    console.error("Seed error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
