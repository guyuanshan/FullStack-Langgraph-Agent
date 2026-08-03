"use client";

import { useEffect, useState } from "react";
import { signOutAndClearTenant } from "../../lib/auth/client";

type TenantMembership = {
  tenantId: string;
  tenantName: string;
  role: string;
};

type TenantSelectorProps = {
  userName: string;
  userEmail: string;
  memberships: TenantMembership[];
};

export function TenantSelector({
  userName,
  userEmail,
  memberships,
}: TenantSelectorProps) {
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const soleTenantId =
    memberships.length === 1 ? memberships[0]?.tenantId ?? null : null;

  useEffect(() => {
    if (!soleTenantId) {
      return;
    }

    let cancelled = false;

    async function autoSelect() {
      setPendingTenantId(soleTenantId);
      setErrorMessage(null);

      const response = await fetch("/api/auth/tenant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: soleTenantId }),
      });

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setPendingTenantId(null);
        setErrorMessage("无法切换到该租户，请刷新页面后重试。");
        return;
      }

      window.location.assign("/");
    }

    void autoSelect();

    return () => {
      cancelled = true;
    };
  }, [soleTenantId]);

  async function selectTenant(tenantId: string) {
    setPendingTenantId(tenantId);
    setErrorMessage(null);

    const response = await fetch("/api/auth/tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenantId }),
    });

    if (!response.ok) {
      setPendingTenantId(null);
      setErrorMessage("无法切换到该租户，请刷新页面后重试。");
      return;
    }

    window.location.assign("/");
  }

  async function signOut() {
    await signOutAndClearTenant();
  }

  return (
    <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
      <p className="text-sm font-medium text-slate-500">
        {userName} · {userEmail}
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-950">选择租户</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        后续会话和工具操作都将在所选租户的权限范围内执行。
      </p>

      {memberships.length > 0 ? (
        <div className="mt-6 space-y-3">
          {memberships.map((membership) => (
            <button
              key={membership.tenantId}
              type="button"
              disabled={pendingTenantId !== null}
              onClick={() => void selectTenant(membership.tenantId)}
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-slate-950 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>
                <span className="block font-medium text-slate-950">
                  {membership.tenantName}
                </span>
                <span className="mt-1 block text-xs uppercase tracking-wide text-slate-500">
                  {membership.role}
                </span>
              </span>
              <span className="text-sm text-slate-500">
                {pendingTenantId === membership.tenantId
                  ? "正在进入…"
                  : "进入 →"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          当前账号尚未加入任何租户，请联系管理员。
        </p>
      )}

      {errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-6 text-sm text-slate-500 underline-offset-4 hover:text-slate-950 hover:underline"
      >
        退出登录
      </button>
    </div>
  );
}
