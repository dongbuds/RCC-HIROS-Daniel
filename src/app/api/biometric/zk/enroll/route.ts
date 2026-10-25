import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth-token";
import { db } from "@/lib/db";
import { KIOSK_SERVICE_URL } from "@/lib/kiosk";

// ═══════════════════════════════════════════════════════════════
// POST /api/biometric/zk/enroll  — biometric.enroll | canManageBiometrics
// { employeeId, fingerIndex, regTemplateB64, deviceName?, swipesCaptured? }
// Creates/updates BiometricTemplate with engine="zk"
// ═══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAnyPermission(request, [
      "biometric.enroll",
      "biometric.manage",
    ]);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { employeeId, fingerIndex, regTemplateB64, deviceName, swipesCaptured } =
      body as {
        employeeId?: string;
        fingerIndex?: number;
        regTemplateB64?: string;
        deviceName?: string;
        swipesCaptured?: number;
      };

    if (!employeeId || fingerIndex === undefined || !regTemplateB64) {
      return NextResponse.json(
        { error: "Missing employeeId, fingerIndex, or regTemplateB64" },
        { status: 400 }
      );
    }

    if (fingerIndex < 0 || fingerIndex > 1) {
      return NextResponse.json(
        { error: "fingerIndex must be 0 or 1" },
        { status: 400 }
      );
    }

    // Validate template is valid base64
    let decoded: Uint8Array;
    try {
      decoded = Uint8Array.from(atob(regTemplateB64), (c) => c.charCodeAt(0));
    } catch {
      return NextResponse.json(
        { error: "Invalid regTemplateB64 (not valid base64)" },
        { status: 400 }
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    // Check existing count for this employee
    const count = await db.biometricTemplate.count({ where: { employeeId } });

    // Check if this finger slot is already taken
    const existingFinger = await db.biometricTemplate.findFirst({
      where: { employeeId, fingerIndex },
    });

    const templateData = JSON.stringify({
      regTemplate: regTemplateB64,
      swipesCaptured,
      deviceName: deviceName ?? "zk-kiosk",
      enrolledAt: new Date().toISOString(),
    });

    let template;
    if (existingFinger) {
      // Replace existing enrollment for this finger
      template = await db.biometricTemplate.update({
        where: { id: existingFinger.id },
        data: {
          engine: "zk",
          credentialId: null,
          credentialPubKey: null,
          counter: 0,
          quality: 100,
          templateData,
        },
      });
    } else {
      // Check max 2 fingers per employee
      if (count >= 2) {
        return NextResponse.json(
          { error: "Maximum 2 fingers per employee" },
          { status: 400 }
        );
      }

      template = await db.biometricTemplate.create({
        data: {
          employeeId,
          fingerIndex,
          engine: "zk",
          credentialId: null,
          credentialPubKey: null,
          counter: 0,
          quality: 100,
          templateData,
        },
      });
    }

    await db.auditLog.create({
      data: {
        userId: auth.user.id,
        action: "Enroll Fingerprint (ZK)",
        entity: "BiometricTemplate",
        entityId: template.id,
        metadata: JSON.stringify({
          employeeId,
          fingerIndex,
          swipesCaptured,
          deviceName: deviceName ?? "zk-kiosk",
        }),
      },
    });

    return NextResponse.json({
      success: true,
      template: {
        id: template.id,
        fingerIndex: template.fingerIndex,
        quality: template.quality,
      },
    });
  } catch (error) {
    console.error("[API /biometric/zk/enroll] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}