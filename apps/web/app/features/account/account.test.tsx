import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ORIGIN, server } from "../../test/mocks/server";
import { renderRoutes } from "../../test/render";
import { chooseOption } from "../../test/select";
import { authStore } from "../auth/authStore";
import { AccountPage } from "./AccountPage";

const USER = {
  id: "9a1c66d0-1111-4111-8111-111111111111",
  email: "student@example.com",
  display_name: "小明",
  current_level: "N2" as const,
  avatar: null,
};

const ME = { ...USER, activated: true };

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  authStore.clear();
  window.localStorage.clear();
});
afterAll(() => server.close());

function renderAccount() {
  return renderRoutes([
    { path: "study/account", Component: AccountPage },
    { path: "login", element: <p>login-page</p> },
    { path: "study", element: <p>study-home</p> },
  ], "/study/account");
}

describe("AccountPage", () => {
  it("redirects guests to /login", async () => {
    renderAccount();
    expect(await screen.findByText("login-page")).toBeInTheDocument();
  });

  it("shows nickname, email and target level", () => {
    authStore.setSession("tok", USER);
    renderAccount();
    expect(screen.getByText("小明", { selector: ".account-display-name" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("student@example.com").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "备考等级" })).toHaveTextContent("N2");
  });

  it("edits avatar and nickname with one PATCH and updates the store", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(http.patch(`${ORIGIN}/api/me`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ...ME, avatar: "fox", display_name: "新名字" });
    }));
    authStore.setSession("tok", USER);
    renderAccount();

    await user.click(screen.getByRole("button", { name: "编辑资料" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "狐狸" }));
    const input = within(dialog).getByLabelText("昵称");
    await user.clear(input);
    await user.type(input, "新名字");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(body).toEqual({ avatar: "fox", display_name: "新名字" });
    expect(authStore.get().user).toMatchObject({ avatar: "fox", display_name: "新名字" });
  });

  it("choosing the default avatar sends avatar:null", async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> = {};
    server.use(http.patch(`${ORIGIN}/api/me`, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...ME, avatar: null });
    }));
    authStore.setSession("tok", { ...USER, avatar: "owl" });
    renderAccount();
    await user.click(screen.getByRole("button", { name: "编辑资料" }));
    await user.click(screen.getByRole("radio", { name: "默认头像" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(body).toHaveProperty("avatar", null));
  });

  it("cancel discards the draft without calling the API", async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(http.patch(`${ORIGIN}/api/me`, () => {
      called = true;
      return HttpResponse.json(ME);
    }));
    authStore.setSession("tok", USER);
    renderAccount();
    await user.click(screen.getByRole("button", { name: "编辑资料" }));
    await user.click(screen.getByRole("radio", { name: "锦鲤" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(called).toBe(false);
    expect(authStore.get().user?.avatar).toBeNull();
  });

  it("shows the server's field-level error and keeps the dialog open", async () => {
    const user = userEvent.setup();
    server.use(http.patch(`${ORIGIN}/api/me`, () =>
      HttpResponse.json(
        { detail: { field: "display_name", message: "昵称长度需在 1–128 字符" } },
        { status: 400 })));
    authStore.setSession("tok", USER);
    renderAccount();
    await user.click(screen.getByRole("button", { name: "编辑资料" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("昵称长度需在");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables saving an empty nickname", async () => {
    const user = userEvent.setup();
    authStore.setSession("tok", USER);
    renderAccount();
    await user.click(screen.getByRole("button", { name: "编辑资料" }));
    await user.clear(screen.getByLabelText("昵称"));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("changing the level syncs to the profile", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(http.patch(`${ORIGIN}/api/me`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ...ME, current_level: "N1" });
    }));
    authStore.setSession("tok", USER);
    renderAccount();
    await chooseOption(user, "备考等级", "N1");
    await waitFor(() => expect(body).toEqual({ current_level: "N1" }));
  });

  it("signing out returns to the study home", async () => {
    const user = userEvent.setup();
    server.use(http.post(`${ORIGIN}/api/auth/logout`, () =>
      HttpResponse.json({ status: "ok" })));
    authStore.setSession("tok", USER);
    renderAccount();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByText("study-home")).toBeInTheDocument();
    expect(authStore.get().user).toBeNull();
  });
});
