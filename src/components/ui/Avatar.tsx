import React, { useEffect, useState } from 'react';
import { cn, getInitials } from '../../lib/utils';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export function Avatar({ src, name, size = 'sm', className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  const effectiveSrc =
    src && !src.includes('avatar_engineer_') ? src : null;

  useEffect(() => {
    setFailed(false);
  }, [effectiveSrc]);

  const sizes = {
    xs: 'h-5 w-5 text-[10px]',
    sm: 'h-7 w-7 text-xs',
    md: 'h-9 w-9 text-xs',
    lg: 'h-12 w-12 text-sm',
  };

  if (effectiveSrc && !failed) {
    return (
      <img
        src={effectiveSrc}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(
          'rounded-full object-cover border border-neutral-200 dark:border-neutral-800 shrink-0',
          sizes[size],
          className
        )}
      />
    );
  }

  return (
    <div
      aria-label={name}
      className={cn(
        'rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 font-medium flex items-center justify-center border border-neutral-300 dark:border-neutral-700 shrink-0 select-none',
        sizes[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}
