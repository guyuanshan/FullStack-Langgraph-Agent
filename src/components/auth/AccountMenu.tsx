"use client";

import Link from "next/link";
import { useState } from "react";
import { signOutAndClearTenant } from "../../lib/auth/client";

type AccountMenuProps = {
  email: string;
  tenantName: string;
  role: string;
};

export function AccountMenu({ email, tenantName, role }: AccountMenuProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await signOutAndClearTenant();
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right lg:block">
        <p className="text-xs font-medium text-slate-700">{tenantName}</p>
        <p className="text-[11px] text-slate-500">
          {email} · {role}
        </p>
      </div>
      <Link
        href="/select-tenant"
        className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700"
      >
        切换租户
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={isSigningOut}
        className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-60"
      >
        {isSigningOut ? "退出中…" : "退出"}
      </button>
    </div>
  );
}
