import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ORIGIN, server } from "../../test/mocks/server";
import { chooseOption } from "../../test/select";
import { renderRoutes } from "../../test/render";
import { authStore, useAuth } from "./authStore";
import { useLevel } from "./useLevel";
import { HeaderControls } from "./HeaderControls";
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./AuthPages";
import { fieldErrorFrom } from "../../api/endpoints/auth";
import { ApiError } from "../../api/errors";

const USER = {
  id: "9a1c66d0-1111-4111-8111-111111111111",
  email: "student@example.com",
  display_name: "小明",
  current_level: "N2" as const,
  avatar: null,
};

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  authStore.clear();
  window.localStorage.clear();
});
afterAll(() => server.close());

// ------------------------------------------------------------ authStore ----

describe("authStore", () => {
  function Probe() {
    const auth = useAuth();
    return <p>user:{auth.user?.email ?? "logged-out"}</p>;
  }

  it("setSession persists token+profile, useAuth reflects, clear wipes both", async () => {
    renderRoutes([{ path: "study", Component: Probe }], "/study");
    expect(screen.getByText("user:logged-out")).toBeInTheDocument();

    authStore.setSession("tok-123", USER);
    expect(await screen.findByText(`user:${USER.email}`)).toBeInTheDocument();
    expect(window.localStorage.getItem("jlptgo.session_token")).toBe("tok-123");
    expect(JSON.parse(window.localStorage.getItem("jlptgo.auth.profile")!))
      .toMatchObject({ token: "tok-123", user: { email: USER.email } });

    authStore.clear();
    expect(await screen.findByText("user:logged-out")).toBeInTheDocument();
    expect(window.localStorage.getItem("jlptgo.session_token")).toBeNull();
    expect(window.localStorage.getItem("jlptgo.auth.profile")).toBeNull();
  });
});

// ------------------------------------------------------------- useLevel ----

describe("useLevel", () => {
  function Probe() {
    const { level, setLevel } = useLevel();
    return (
      <div>
        <span>current:{level ?? "none"}</span>
        <button type="button" onClick={() => setLevel("N1")}>pick N1</button>
      </div>
    );
  }

  it("guest choice lands in localStorage immediately, no server call", async () => {
    const user = userEvent.setup();
    let meCalled = false;
    server.use(http.patch(`${ORIGIN}/api/me`, () => {
      meCalled = true;
      return HttpResponse.json({});
    }));
    renderRoutes([{ path: "study", Component: Probe }], "/study");
    expect(screen.getByText("current:none")).toBeInTheDocument();
    await user.click(screen.getByText("pick N1"));
    expect(screen.getByText("current:N1")).toBeInTheDocument();
    expect(window.localStorage.getItem("jlptgo.level")).toBe("N1");
    expect(meCalled).toBe(false);
  });

  it("logged-in choice syncs to the profile via PATCH /api/me", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    server.use(http.patch(`${ORIGIN}/api/me`, async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ ...USER, activated: true,
        current_level: "N1" });
    }));
    authStore.setSession("tok-123", USER);
    renderRoutes([{ path: "study", Component: Probe }], "/study");
    expect(screen.getByText("current:N2")).toBeInTheDocument();
    await user.click(screen.getByText("pick N1"));
    expect(await screen.findByText("current:N1")).toBeInTheDocument();
    expect(patches).toEqual([{ current_level: "N1" }]);
    expect(authStore.get().user?.current_level).toBe("N1");

    // PATCH failure keeps the local choice (best-effort sync)
    server.use(http.patch(`${ORIGIN}/api/me`, () =>
      HttpResponse.json({ detail: "boom" }, { status: 500 })));
    await user.click(screen.getByText("pick N1"));
    expect(screen.getByText("current:N1")).toBeInTheDocument();
  });
});

// -------------------------------------------------------- HeaderControls ----

describe("HeaderControls", () => {
  it("shows sign-in/sign-up links when logged out, and no avatar", () => {
    renderRoutes([{ path: "study", Component: HeaderControls }], "/study");
    expect(screen.getByRole("link", { name: "登录" }))
      .toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "注册" }))
      .toHaveAttribute("href", "/register");
    expect(screen.queryByRole("link", { name: "用户中心" })).not.toBeInTheDocument();
  });

  it("guests get the level selector too, with a 全部等级 option", async () => {
    const user = userEvent.setup();
    renderRoutes([{ path: "study", Component: HeaderControls }], "/study");
    const sel = screen.getByRole("combobox", { name: "备考等级" });
    expect(sel).toHaveTextContent("全部等级");
    await chooseOption(user, "备考等级", "N3");
    expect(sel).toHaveTextContent("N3");
    expect(window.localStorage.getItem("jlptgo.level")).toBe("N3");
    await chooseOption(user, "备考等级", "全部等级");
    expect(window.localStorage.getItem("jlptgo.level")).toBeNull();
  });

  it("signed-in students cannot clear their level (no 全部等级 option)", async () => {
    const user = userEvent.setup();
    authStore.setSession("tok-123", USER);
    renderRoutes([{ path: "study", Component: HeaderControls }], "/study");
    await user.click(screen.getByRole("combobox", { name: "备考等级" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent))
      .toEqual(["N5", "N4", "N3", "N2", "N1"]);
  });

  it("signed in: level selector beside an avatar linking to the user center", () => {
    authStore.setSession("tok-123", USER);
    renderRoutes([{ path: "study", Component: HeaderControls }], "/study");
    const avatar = screen.getByRole("link", { name: "用户中心" });
    expect(avatar).toHaveAttribute("href", "/study/account");
    // default solid avatar carries the first character of the nickname
    expect(avatar).toHaveTextContent("小");
    expect(screen.getByRole("combobox", { name: "备考等级" })).toHaveTextContent("N2");
    // no menu, name or sign-out in the header
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByText("退出登录")).not.toBeInTheDocument();
    expect(screen.queryByText("小明")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "登录" })).not.toBeInTheDocument();
  });

  it("changing the header level syncs to the profile", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(http.patch(`${ORIGIN}/api/me`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ...USER, current_level: "N1", activated: true });
    }));
    authStore.setSession("tok-123", USER);
    renderRoutes([{ path: "study", Component: HeaderControls }], "/study");
    await chooseOption(user, "备考等级", "N1");
    await waitFor(() => expect(body).toEqual({ current_level: "N1" }));
    await waitFor(() => expect(authStore.get().user?.current_level).toBe("N1"));
  });

  it("renders the chosen avatar image", () => {
    authStore.setSession("tok-123", { ...USER, avatar: "fox" });
    renderRoutes([{ path: "study", Component: HeaderControls }], "/study");
    expect(screen.getByRole("link", { name: "用户中心" }).querySelector("img"))
      .not.toBeNull();
  });

  it("clicking the avatar navigates to the user center", async () => {
    const user = userEvent.setup();
    authStore.setSession("tok-123", USER);
    renderRoutes([
      { path: "study", Component: HeaderControls },
      { path: "study/account", element: <p>account-page</p> },
    ], "/study");
    await user.click(screen.getByRole("link", { name: "用户中心" }));
    expect(await screen.findByText("account-page")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------ auth pages ----

describe("auth pages", () => {
  it("login stores the session and enters the study area", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${ORIGIN}/api/auth/login`, () =>
      HttpResponse.json({
        token: "tok-123",
        expires_at: "2026-12-16T00:00:00+00:00",
        user: USER,
      })));
    renderRoutes([
      { path: "login", Component: LoginPage },
      { path: "study", Component: () => <p>study home</p> },
    ], "/login");
    await user.type(screen.getByLabelText(/邮箱/), "student@example.com");
    await user.type(screen.getByLabelText(/密码/), "study-hard-88");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByText("study home");
    expect(authStore.get().user?.email).toBe(USER.email);
    expect(window.localStorage.getItem("jlptgo.session_token")).toBe("tok-123");
  });

  it("login failure surfaces the unified server message", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${ORIGIN}/api/auth/login`, () =>
      HttpResponse.json({ detail: "邮箱或密码错误，或账户未验证" },
        { status: 401 })));
    renderRoutes([{ path: "login", Component: LoginPage }], "/login");
    await user.type(screen.getByLabelText(/邮箱/), "student@example.com");
    await user.type(screen.getByLabelText(/密码/), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("邮箱或密码错误，或账户未验证");
    expect(authStore.get().user).toBeNull();
  });

  it("register maps field-level 400s to their field; success shows the mail notice", async () => {
    const user = userEvent.setup();
    renderRoutes([{ path: "register", Component: RegisterPage }], "/register");
    await user.type(screen.getByLabelText(/邮箱/), "student@example.com");
    await user.type(screen.getByLabelText(/密码（至少 8 位）/), "study-hard-88");
    server.use(http.post(`${ORIGIN}/api/auth/register`, () =>
      HttpResponse.json({ detail: { field: "email", message: "该邮箱已注册" } },
        { status: 400 })));
    await user.click(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("该邮箱已注册");

    server.use(http.post(`${ORIGIN}/api/auth/register`, () =>
      HttpResponse.json({ status: "ok" })));
    await user.clear(screen.getByLabelText(/邮箱/));
    await user.type(screen.getByLabelText(/邮箱/), "other@example.com");
    await user.click(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByText(/验证邮件已发送到/)).toHaveTextContent(
      "other@example.com");
  });

  it("verify-email reflects ok / already / invalid outcomes", async () => {
    renderRoutes([{ path: "verify-email", Component: VerifyEmailPage }],
      "/verify-email");
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("验证链接无效或已过期");

    server.use(http.post(`${ORIGIN}/api/auth/verify-email`, () =>
      HttpResponse.json({ status: "ok" })));
    renderRoutes([{ path: "verify-email", Component: VerifyEmailPage }],
      "/verify-email?token=good");
    expect(await screen.findByText("邮箱验证完成，账户已激活。")).toBeInTheDocument();

    server.use(http.post(`${ORIGIN}/api/auth/verify-email`, () =>
      HttpResponse.json({ status: "already" })));
    renderRoutes([{ path: "verify-email", Component: VerifyEmailPage }],
      "/verify-email?token=replay");
    expect(await screen.findByText("该链接已使用过，账户此前已激活。"))
      .toBeInTheDocument();
  });

  it("forgot-password always answers with the uniform notice", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${ORIGIN}/api/auth/forgot-password`, () =>
      HttpResponse.json({ status: "ok" })));
    renderRoutes([{ path: "forgot-password", Component: ForgotPasswordPage }],
      "/forgot-password");
    await user.type(screen.getByLabelText(/注册邮箱/), "student@example.com");
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));
    expect(await screen.findByText(/重置链接已发送/)).toBeInTheDocument();
  });

  it("reset-password requires a token and reports success", async () => {
    const user = userEvent.setup();
    renderRoutes([{ path: "reset-password", Component: ResetPasswordPage }],
      "/reset-password");
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("链接缺少重置令牌");

    server.use(http.post(`${ORIGIN}/api/auth/reset-password`, () =>
      HttpResponse.json({ status: "ok" })));
    renderRoutes([{ path: "reset-password", Component: ResetPasswordPage }],
      "/reset-password?token=good");
    await user.type(screen.getByLabelText(/新密码（至少 8 位）/), "new-pass-99");
    await user.click(screen.getByRole("button", { name: "重置密码" }));
    expect(await screen.findByText("密码已更新，原有登录状态已全部失效。"))
      .toBeInTheDocument();
  });
});

// ------------------------------------------------------- DTO / helpers ----

describe("auth endpoint helpers", () => {
  it("fieldErrorFrom extracts 400 field details and ignores other errors", () => {
    const fe = fieldErrorFrom(
      new ApiError(400, "server_error", "request failed",
        { field: "email", message: "该邮箱已注册" }));
    expect(fe).toEqual({ field: "email", message: "该邮箱已注册" });
    expect(fieldErrorFrom(new ApiError(401, "unauthorized", "nope"))).toBeNull();
    expect(fieldErrorFrom(new Error("plain"))).toBeNull();
  });
});
