import { NextResponse } from "next/server";
import {
  setActiveTenantCookie,
} from "../../../../lib/auth/cookies";
import {
  readActiveTenantId,
  requireAuthenticatedUser,
} from "../../../../lib/auth/context";
import {
  AuthContextError,
  authErrorResponse,
} from "../../../../lib/auth/errors";
import { assertSameOrigin } from "../../../../lib/auth/origin";
import { prisma } from "../../../../lib/db/client";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const activeTenantId = readActiveTenantId(request.headers);
    const memberships = await prisma.tenantMember.findMany({
      where: {
        userId: user.id,
        tenant: {
          isActive: true,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        role: true,
        tenant: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({
      activeTenantId: memberships.some(
        (membership) => membership.tenant.id === activeTenantId
      )
        ? activeTenantId
        : null,
      memberships: memberships.map((membership) => ({
        tenantId: membership.tenant.id,
        tenantName: membership.tenant.name,
        role: membership.role,
      })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let userId: string | undefined;

  try {
    assertSameOrigin(request);

    const user = await requireAuthenticatedUser(request);
    userId = user.id;
    const body = (await request.json()) as unknown;
    const tenantId =
      body && typeof body === "object" && "tenantId" in body
        ? (body as { tenantId?: unknown }).tenantId
        : null;

    if (
      typeof tenantId !== "string" ||
      tenantId.trim() === "" ||
      tenantId.length > 128
    ) {
      return NextResponse.json(
        {
          error: "INVALID_TENANT_ID",
          message: "Expected body: { tenantId: string }.",
        },
        { status: 400 }
      );
    }

    const membership = await prisma.tenantMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId: user.id,
        },
      },
      select: {
        id: true,
        tenant: {
          select: {
            isActive: true,
          },
        },
      },
    });

    if (!membership?.tenant.isActive) {
      throw new AuthContextError("INVALID_TENANT_MEMBERSHIP", 403);
    }

    const response = new NextResponse(null, { status: 204 });
    setActiveTenantCookie(response, tenantId);
    return response;
  } catch (error) {
    return authErrorResponse(error, userId);
  }
}
