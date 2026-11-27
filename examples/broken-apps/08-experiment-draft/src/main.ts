import { renderButton } from './checkout';
import { flushOnExit, startFlags } from './flags';
import { currentUser } from './session';

const variant = await startFlags(currentUser());
renderButton(variant);
flushOnExit();
