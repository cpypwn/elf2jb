# elf2jb

standalone ns2jb host for jailbroken ps5 consoles.

1. load `elf2jb-host.elf`; the browser opens automatically.
2. follow the on-screen instructions, or open `http://your-ps5-ip:8088`.
3. after 4/4 verification, the host keeps RPC open and automatically sends the Switch GPU greeting, with `hellow from ps5!` and `~ cpypwn` centered on screen. keep the ELF and SmileBASIC running, then select **finish session** to release RPC.
4. after failure, restart the switch 2 and reopen smilebasic, then select **restart host**.

tested on a ps5 pro running 13.60, with both consoles connected by ethernet to the same wired network.

console testing has passed step 2/4. a complete run and the GPU greeting still need Switch testing.

this source bundles [Cellenseres/ns2jb](https://github.com/Cellenseres/ns2jb). if a run stops, open `http://your-ps5-ip:8088/status` and save the `diagnostics` entry; it includes the FS acquisition error from the run folder.

[download](https://github.com/cpypwn/elf2jb/releases/tag/v0.1.6) · [switch 2 setup](https://github.com/Cellenseres/ns2jb)

payload manager source:
`https://cpypwn.github.io/elf2jb/payloads.json`
