import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { KIOSK_SERVICE_URL } from "@/lib/kiosk";

// Rate limit: one request per employeeId per 5 seconds (like kiosk/clock)
const lastRequest = new Map<string, number>();
const RATE_LIMIT_MS = 5000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/biometric/zk/authenticate  — UNAUTHENTICATED (kiosk)
// { liveB64, deviceName? }
// 1:N match via local kiosk-service → clock in/out
// ═══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { liveB64, deviceName } = body as {
      liveB64?: string;
      deviceName?: string;
    };

    if (!liveB64) {
      return NextResponse.json(
        { error: "Missing liveB64" },
        { status: 400 }
      );
    }

    // Load all ZK templates (engine = "zk")
    const templates = await db.biometricTemplate.findMany({
      where: { engine: "zk" },
      include: { employee: { select: { id: true, employeeId: true, firstName: true, lastName: true, photo: true } } },
    });

    if (templates.length === 0) {
      return NextResponse.json(
        { error: "No enrolled fingerprints (ZK)" },
        { status: 404 }
      );
    }

    // Call local kiosk-service for 1:N match
    const identifyRes = await fetch(`${KIOSK_SERVICE_URL}/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        liveB64,
        templates: templates.map((t) => ({
          fid: Number(t.id.replace(/[^0-9]/g, "").slice(0, 9)) || 1,
          templateB64: JSON.parse(t.templateData || "{}").regTemplate || "",
        })).filter((t) => t.templateB64),
      }),
    });

    if (!identifyRes.ok) {
      const err = await identifyRes.text().catch(() => "identify failed");
      console.error("[zk-authenticate] identify service error:", err);
      return NextResponse.json(
        { error: "Fingerprint match service unavailable" },
        { status: 503 }
      );
    }

    const { fid, score } = await identifyRes.json();
    if (!fid) {
      return NextResponse.json(
        { error: "Fingerprint not recognized" },
        { status: 401 }
      );
    }

    // Find matched template by matching fid
    // The fid we passed is a numeric ID derived from the cuid; we need to match back
    const matched = templates.find((t) => {
      const numId = Number(t.id.replace(/[^0-9]/g, "").slice(0, 9)) || 1;
      return numId === fid;
    });

    if (!matched || !matched.employee) {
      return NextResponse.json(
        { error: "Matched template not found" },
        { status: 500 }
      );
    }

    // Rate limit per employee
    const nowTs = Date.now();
    const last = lastRequest.get(matched.employee.id);
    if (last && nowTs - last < RATE_LIMIT_MS) {
      return NextResponse.json(
        { error: "Please wait before scanning again" },
        { status: 429 }
      );
    }
    lastRequest.set(matched.employee.id, nowTs);

    // Employee must be active
    const employee = await db.employee.findUnique({
      where: { id: matched.employee.id, active: true },
      select: { id: true, employeeId: true, firstName: true, lastName: true, photo: true },
    });
    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found or inactive" },
        { status: 404 }
      );
    }

    const now = new Date();
    const dayStart = startOfDay(now);

    // Find today's attendance record
    const existing = await db.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: dayStart, lte: new Date(dayStart.getTime() + 86400000 - 1) },
      },
    });

    let action: string;
    let message: string;
    let record;

    if (!existing || !existing.clockInAt) {
      // Clock in
      record = await db.attendance.upsert({
        where: {
          employeeId_date: { employeeId: employee.id, date: dayStart },
        },
        update: {
          clockInAt: now,
          clockInOnPremise: true,
          clockInDistance: 0,
          biometricVerified: true,
        },
        create: {
          employeeId: employee.id,
          date: dayStart,
          clockInAt: now,
          clockInOnPremise: true,
          clockInDistance: 0,
          biometricVerified: true,
        },
      });

      action = "clock_in";
      message = `Clocked in at ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;

      await db.auditLog.create({
        data: {
          userId: employee.id,
          action: "Clock In (Kiosk - ZK Fingerprint)",
          entity: "Attendance",
          entityId: record.id,
          metadata: JSON.stringify({ source: "zk-kiosk", deviceName, score }),
        },
      });
    } else if (existing.clockOutAt) {
      // Already clocked out
      return NextResponse.json({
        action: "already_clocked_out",
        employee,
        attendance: {
          id: existing.id,
          clockInAt: existing.clockInAt?.toISOString(),
          clockOutAt: existing.clockOutAt?.toISOString(),
        },
        message: "Already clocked out today",
      });
    } else {
      // Clock out
      record = await db.attendance.update({
        where: { id: existing.id },
        data: {
          clockOutAt: now,
          clockOutOnPremise: true,
          clockOutDistance: 0,
        },
      });

      action = "clock_out";
      message = `Clocked out at ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;

      await db.auditLog.create({
        data: {
          userId: employee.id,
          action: "Clock Out (Kiosk - ZK Fingerprint)",
          entity: "Attendance",
          entityId: record.id,
          metadata: JSON.stringify({ source: "zk-kiosk", deviceName, score }),
        },
      });
    }

    return NextResponse.json({
      action,
      employee,
      attendance: {
        id: record.id,
        clockInAt: record.clockInAt?.toISOString(),
        clockOutAt: record.clockOutAt?.toISOString(),
      },
      message,
    });
  } catch (error) {
    console.error("[API /biometric/zk/authenticate] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}