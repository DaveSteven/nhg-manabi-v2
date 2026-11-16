/**
 * Fixed avatar set (reused from v1, same ids as the backend whitelist
 * `student_auth.AVATAR_IDS`). No custom upload. NULL/unknown id falls back
 * to the default solid-colour avatar.
 */
import fox from "../../assets/avatars/fox.webp";
import hokkaidoBrownBear from "../../assets/avatars/hokkaido-brown-bear.webp";
import japaneseMacaque from "../../assets/avatars/japanese-macaque.webp";
import koi from "../../assets/avatars/koi.webp";
import manekiNeko from "../../assets/avatars/maneki-neko.webp";
import owl from "../../assets/avatars/owl.webp";
import rabbit from "../../assets/avatars/rabbit.webp";
import redCrownedCrane from "../../assets/avatars/red-crowned-crane.webp";
import shibaInu from "../../assets/avatars/shiba-inu.webp";
import shimaEnaga from "../../assets/avatars/shima-enaga.webp";
import sikaDeer from "../../assets/avatars/sika-deer.webp";
import tanuki from "../../assets/avatars/tanuki.webp";

export interface AvatarOption {
  id: string;
  label: string;
  url: string;
}

export const AVATARS: AvatarOption[] = [
  { id: "shiba-inu", label: "柴犬", url: shibaInu },
  { id: "fox", label: "狐狸", url: fox },
  { id: "tanuki", label: "狸猫", url: tanuki },
  { id: "rabbit", label: "兔子", url: rabbit },
  { id: "maneki-neko", label: "招财猫", url: manekiNeko },
  { id: "japanese-macaque", label: "日本猕猴", url: japaneseMacaque },
  { id: "hokkaido-brown-bear", label: "棕熊", url: hokkaidoBrownBear },
  { id: "sika-deer", label: "梅花鹿", url: sikaDeer },
  { id: "red-crowned-crane", label: "丹顶鹤", url: redCrownedCrane },
  { id: "owl", label: "猫头鹰", url: owl },
  { id: "shima-enaga", label: "银喉长尾山雀", url: shimaEnaga },
  { id: "koi", label: "锦鲤", url: koi },
];

export function avatarUrl(id?: string | null): string | null {
  if (!id) return null;
  return AVATARS.find((a) => a.id === id)?.url ?? null;
}

/** Stable default colour (0–3) per user so the solid avatar doesn't flicker. */
export function defaultColorIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 4;
}
