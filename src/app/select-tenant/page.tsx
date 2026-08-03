import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TenantSelector } from "../../components/auth/TenantSelector";
import { requireAuthenticatedUserFromHeaders } from "../../lib/auth/context";
import { isAuthContextError } from "../../lib/auth/errors";
import { prisma } from "../../lib/db/client";

export const metadata = {
  title: "选择租户 · Fullstack LangGraph Agent",
};

export default async function SelectTenantPage() {
  let user;

  try {
    user = await requireAuthenticatedUserFromHeaders(await headers());
  } catch (error) {
    if (isAuthContextError(error) && error.code === "UNAUTHENTICATED") {
      redirect("/sign-in");
    }

    throw error;
  }

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <TenantSelector
        userName={user.name}
        userEmail={user.email}
        memberships={memberships.map((membership) => ({
          tenantId: membership.tenant.id,
          tenantName: membership.tenant.name,
          role: membership.role,
        }))}
      />
    </main>
  );
}
