declare module "react" {
	export function createElement(
		type: string,
		props?: Record<string, unknown> | null,
		...children: unknown[]
	): unknown;

	export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
	export function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
}
