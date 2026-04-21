declare module 'swagger-ui-dist/swagger-ui-bundle.js' {
	const SwaggerUiBundle: (options: Record<string, unknown>) => {
		destroy?: () => void;
	};

	export default SwaggerUiBundle;
}
