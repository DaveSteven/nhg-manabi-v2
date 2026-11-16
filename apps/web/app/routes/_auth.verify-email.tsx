import type { MetaFunction } from "react-router";
import { VerifyEmailPage } from "../features/auth/AuthPages";

export const meta: MetaFunction = () => [
  { title: "邮箱验证 · JLPT GO" },
  { name: "robots", content: "noindex" },
];

export default VerifyEmailPage;
