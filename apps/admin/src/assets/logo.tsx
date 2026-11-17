import { type ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Logo({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src='/images/favicon.svg'
      alt='MINAO'
      width={24}
      height={24}
      className={cn('size-6 rounded-md', className)}
      {...props}
    />
  )
}
