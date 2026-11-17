import type { MetaFunction } from "react-router";
import { RegisterPage } from "../features/auth/AuthPages";

export const meta: MetaFunction = () => [
  { title: "注册 · MINAO" },
  { name: "robots", content: "noindex" },
];

export default RegisterPage;
