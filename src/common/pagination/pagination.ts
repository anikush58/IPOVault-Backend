export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function paginationOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function paginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.ceil(total / safeLimit);
  return { page, limit, total, totalPages };
}
