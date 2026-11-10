# Public release checklist

This repository is a separate private copy of the web app with a new Git history. It does not share the original Daylight deployment or its Git history.

## Before changing visibility

- [x] Remove tracked deployment metadata, build output, verification files, and the Android client from this web release.
- [x] Include a blank environment template and keep local environment files ignored.
- [x] Replace links to the maintainer's deployment and original repository.
- [x] Add a reuse license and retain the bundled vendor stylesheet license.
- [ ] Review the first commit, all branches and tags in **this** repository, and any GitHub Actions logs or artifacts before making it public.
- [ ] Rotate any real credential if a scan or manual review finds one; deleting a file does not revoke a credential.
- [ ] Confirm you have rights to publish all retained code and assets.

## Verify a new user's setup

- [ ] Clone this repository into a new directory on a machine with Node.js 22.13+.
- [ ] Create a new Firebase project, enable Google sign-in, authorize localhost, and publish `firestore.rules`.
- [ ] Run `node scripts/setup.mjs`, `npm ci`, and `npm run dev`.
- [ ] Sign in, add a task, project, money entry, and content plan, reload, and confirm persistence.
- [ ] Verify a second account cannot read or modify the first account's records.
- [ ] Run `npm run test`, `npm run lint`, and `npm run build`.
- [ ] Deploy a fresh copy with your own Firebase values and verify sign-in and persistence.

## Launch

- [ ] Add screenshots or a short demo using synthetic data.
- [ ] Change **this** repository's visibility to public.
- [ ] Open the public link signed out to check the README and license.
- [ ] Publish a versioned release and the LinkedIn announcement.

## LinkedIn draft

I built Daylight to bring projects, tasks, money tracking, and content plans into one personal workspace.

I'm sharing the web app's source so others can run their own copy and help improve it. The basic setup uses Next.js and Firebase; Google Calendar, Drive, AI chat, social analytics, and Hermes Agent are optional.

Code and setup guide: https://github.com/itzkumu/daylight-public

If you try it, I'd appreciate feedback on the setup and what you'd improve.

#BuildInPublic #Nextjs #PersonalProductivity
