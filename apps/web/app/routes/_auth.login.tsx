import type { MetaFunction } from "react-router";
import { LoginPage } from "../features/auth/AuthPages";

export const meta: MetaFunction = () => [
  { title: "登录 · MINAO" },
  { name: "robots", content: "noindex" },
];

export default LoginPage;
