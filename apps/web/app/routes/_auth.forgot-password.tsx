import type { MetaFunction } from "react-router";
import { ForgotPasswordPage } from "../features/auth/AuthPages";

export const meta: MetaFunction = () => [
  { title: "找回密码 · MINAO" },
  { name: "robots", content: "noindex" },
];

export default ForgotPasswordPage;
