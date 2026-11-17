import type { MetaFunction } from "react-router";
import { ResetPasswordPage } from "../features/auth/AuthPages";

export const meta: MetaFunction = () => [
  { title: "重置密码 · MINAO" },
  { name: "robots", content: "noindex" },
];

export default ResetPasswordPage;
