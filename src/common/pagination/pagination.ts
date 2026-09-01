export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
};

export function paginationOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function paginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return { page, limit, total };
}
