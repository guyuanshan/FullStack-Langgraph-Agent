import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChatWindow } from "../components/chat/ChatWindow";
import { requireAuthContextFromHeaders } from "../lib/auth/context";
import { isAuthContextError } from "../lib/auth/errors";
import { prisma } from "../lib/db/client";

export default async function Home() {
  let authContext;

  try {
    authContext = await requireAuthContextFromHeaders(await headers());
  } catch (error) {
    if (isAuthContextError(error)) {
      if (error.code === "UNAUTHENTICATED") {
        redirect("/sign-in");
      }

      redirect("/select-tenant");
    }

    throw error;
  }

  const [user, tenant] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: authContext.userId,
      },
      select: {
        email: true,
      },
    }),
    prisma.tenant.findUnique({
      where: {
        id: authContext.tenantId,
      },
      select: {
        name: true,
      },
    }),
  ]);

  if (!user || !tenant) {
    redirect("/select-tenant");
  }

  return (
    <ChatWindow
      account={{
        email: user.email,
        tenantId: authContext.tenantId,
        tenantName: tenant.name,
        role: authContext.role,
      }}
    />
  );
}
