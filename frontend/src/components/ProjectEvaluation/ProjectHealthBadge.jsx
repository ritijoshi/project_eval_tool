import React from 'react';
import { ShieldCheck, AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';

export const ProjectHealthBadge = ({ healthStatus = 'UNKNOWN', size = 'sm' }) => {
  const normalized = String(healthStatus || '').toUpperCase().trim();

  const configs = {
    ON_TRACK: {
      label: 'On Track',
      color: '#4ade80',
      bg: 'rgba(74, 222, 128, 0.14)',
      border: 'rgba(74, 222, 128, 0.35)',
      Icon: ShieldCheck,
    },
    AT_RISK: {
      label: 'At Risk',
      color: '#fbbf24',
      bg: 'rgba(251, 191, 36, 0.14)',
      border: 'rgba(251, 191, 36, 0.35)',
      Icon: AlertTriangle,
    },
    BEHIND: {
      label: 'Behind',
      color: '#f87171',
      bg: 'rgba(248, 113, 113, 0.14)',
      border: 'rgba(248, 113, 113, 0.35)',
      Icon: AlertOctagon,
    },
    UNKNOWN: {
      label: 'Unknown',
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.3)',
      Icon: HelpCircle,
    },
  };

  const current = configs[normalized] || configs.UNKNOWN;
  const { Icon, label, color, bg, border } = current;

  const fontSizes = {
    xs: '0.68rem',
    sm: '0.74rem',
    md: '0.82rem',
  };

  const iconSizes = {
    xs: 11,
    sm: 13,
    md: 15,
  };

  const paddings = {
    xs: '1px 6px',
    sm: '2px 9px',
    md: '4px 12px',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: bg,
        border: `1px solid ${border}`,
        color,
        borderRadius: 20,
        padding: paddings[size] || paddings.sm,
        fontSize: fontSizes[size] || fontSizes.sm,
        fontWeight: 600,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={iconSizes[size] || iconSizes.sm} />
      <span>{label}</span>
    </span>
  );
};

export default ProjectHealthBadge;
