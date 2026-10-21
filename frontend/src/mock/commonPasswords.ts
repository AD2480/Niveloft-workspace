/**
 * The server's list of passwords attackers try first (backend/src/main/resources/security/common-passwords.txt),
 * so the in-browser test API refuses the same ones; a test keeps the two lists the same. The rules mirror PasswordPolicy.java.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(['123456','123456789','12345678','1234567890','password','qwerty','qwertyuiop','qwerty123','1q2w3e4r','1q2w3e4r5t','1qaz2wsx','zaq12wsx','qazwsx','asdfghjkl','asdfgh','zxcvbnm','iloveyou','admin','administrator','welcome','letmein','monkey','dragon','football','baseball','basketball','soccer','hockey','princess','sunshine','shadow','master','superman','batman','trustno1','whatever','starwars','freedom','computer','internet','michael','jennifer','jessica','charlie','thomas','daniel','jordan','hunter','ranger','buster','tigger','pepper','ginger','summer','winter','autumn','spring','flower','cookie','chocolate','banana','orange','purple','silver','golden','diamond','hello','helloworld','hello123','secret','access','login','changeme','default','guest','test','testing','demo','sample','example','pass','passw0rd','p@ssw0rd','p@ssword','passpass','mypassword','newpassword','password1','password12','password123','password1234','password@123','pa55word','abc123','abcd1234','abc12345','aa123456','a1b2c3d4','11111111','00000000','12341234','12344321','87654321','11223344','12121212','123123123','123qweasd','qweasdzxc','q1w2e3r4','1234qwer','qwer1234','asdf1234','zxcv1234','india123','india','bharat','mumbai','delhi','bangalore','bengaluru','kolkata','chennai','hyderabad','pune','cricket','sachin','ganesh','krishna','shiva','jaishreeram','saibaba','omsairam','lovely','loveyou','love123','lover','mylove','babygirl','angel','blessed','godisgood','jesus','heaven','football1','nothing','anything','something','killer','pokemon','naruto','minecraft','fortnite','roblox','google','facebook','instagram','whatsapp','linkedin','microsoft','apple','samsung','nokia','yahoo','gmail','outlook','office','office365','company','business','project','projects','manager','teamwork','niveloft','projectflow','flurry','qwertyui','asdfasdf','zxczxc','abcdefgh','abcdefg','abcdef','aaaaaaaa','iloveu','loveme','fuckyou','superstar','rockstar','starlight','moonlight','sunflower','rainbow','butterfly','dolphin','tiger','lion','eagle','falcon','phoenix','mustang','ferrari','porsche','mercedes','harley','yamaha','liverpool','chelsea','arsenal','barcelona','realmadrid','juventus','manchester','united','london','newyork','america','canada','australia','germany','welcome1','welcome123','letmein1','admin123','admin1234','root','toor','user','user123','student','teacher','school','college','university','summer2024','summer2025','winter2024','winter2025','spring2025','autumn2025','january','february','march','april','august','september','october','november','december','monday','friday','sunday']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't' };

export const TOO_COMMON = 'This password is too common or too easy to guess. A longer phrase of unrelated words works well, or let your password manager make one.';

/** Why a password is too weak beyond the length and character rules, or null (as PasswordPolicy.problem). */
export function commonPasswordProblem(password: string, email: string, name: string): string | null {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return TOO_COMMON;
  if (password.length >= 16) return null;
  const core = [...lower.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')].map((c) => LEET[c] ?? c).join('');
  if (core && COMMON_PASSWORDS.has(core)) return TOO_COMMON;
  if (new Set(lower).size <= 3) return TOO_COMMON;
  const local = email.toLowerCase().replace(/@.*$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  if (local.length >= 4 && lower.replace(/[^\p{L}\p{N}]/gu, '').includes(local)) {
    return 'Your password can’t contain your email address. Choose something others couldn’t guess from it.';
  }
  for (const part of name.toLowerCase().split(/[^\p{L}]+/u)) {
    if (part.length >= 4 && core === part) return 'Your password can’t be just your name with numbers or symbols around it.';
  }
  if (lower.includes('niveloft') || lower.includes('projectflow')) return TOO_COMMON;
  return null;
}
