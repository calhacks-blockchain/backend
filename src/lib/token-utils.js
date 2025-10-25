// Helper functions for token data formatting

export const formatNumber = (num) => {
  if (num === undefined) return 'N/A';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
};

export const formatPercent = (num) => {
  if (num === undefined) return '';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

export const kFormatter = (num) => {
  if (num === undefined) return 'N/A';
  return num > 999 ? `${(num/1000).toFixed(2)}K` : String(num);
};

// Additional utility functions for token data
export const formatTokenAddress = (address) => {
  if (!address) return 'N/A';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const formatTokenSymbol = (address) => {
  if (!address) return 'N/A';
  return address.slice(0, 4).toUpperCase();
};

export const formatTokenName = (description, maxLength = 20) => {
  if (!description) return 'Unknown';
  return description.length > maxLength 
    ? description.slice(0, maxLength) + '...' 
    : description;
};
