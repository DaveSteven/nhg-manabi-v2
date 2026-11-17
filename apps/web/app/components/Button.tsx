import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import type { LinkProps } from "react-router";

/**
 * Standard action buttons — docs/design/button-spec.md. Pages choose
 * variant/size/loading only; radius, height and padding live in
 * styles/_button.scss. Navigation that looks like a button uses
 * <ButtonLink> (a real link), never a button wrapped in a link.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface Look {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keeps width/hierarchy, blocks repeat triggers, sets aria-busy. */
  loading?: boolean;
}

export function buttonClass({ variant = "secondary", size = "md", loading }: Look,
                            extra?: string): string {
  return ["btn", `btn-${variant}`, `btn-${size}`,
    loading ? "is-loading" : "", extra ?? ""].filter(Boolean).join(" ");
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, Look {
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant, size, loading, className, type = "button",
                    disabled, onClick, children, ...rest }, ref) {
    return (
      <button ref={ref} type={type} {...rest}
              className={buttonClass({ variant, size, loading }, className)}
              disabled={disabled}
              aria-busy={loading || undefined}
              aria-disabled={loading || undefined}
              onClick={loading ? (e) => e.preventDefault() : onClick}>
        {children}
      </button>
    );
  });

export interface ButtonLinkProps extends LinkProps, Look {}

export function ButtonLink({ variant, size, loading, className, children,
                             ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={buttonClass({ variant, size, loading }, className)}>
      {children}
    </Link>
  );
}
