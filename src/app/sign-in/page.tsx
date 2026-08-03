import { SignInForm } from "../../components/auth/SignInForm";

export const metadata = {
  title: "登录 · Fullstack LangGraph Agent",
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          LangGraph Agent
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          登录工作台
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          使用管理员分配的账号登录。系统未开放公开注册。
        </p>
        <SignInForm />
      </div>
    </main>
  );
}
