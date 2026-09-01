import { validateEnv, type Env } from './env';

export default (): Env => validateEnv(process.env);
