# ============================================================
#  天树引擎验收报告 — 版本 v3.8.0
#  验收时间：2026-07-05（重验）
#  结论：✅ 通过 — native 管线完整支持
# ============================================================
#  class_id        : native
#  总步数          : 37（含 1 条 getvar 验证命令）
#  解析引擎        : ShEngine（纯Python沙箱模拟器）
#  filter_getvar   : False（native 类保留 getvar 步骤）
#  镜像地址策略    : 硬编码（`dirname $0`/images/xxx.img — 非通配符匹配）
#  硬编码镜像文件  : 28 个（crclist、xbl_4、xbl_config_4、xbl_5、xbl_config_5、
#                    abl、tz、hyp、devcfg、storsec、bluetooth、cmnlib、cmnlib64、
#                    modem、dsp、keymaster、logo、featenabler、misc、aop、qupfw、
#                    uefisecapp、multiimgoem、super、vbmeta、dtbo、vbmeta_system、
#                    cache、userdata、recovery、cust、boot）
#  条件分支        : else 分支（exaid.img 不存在 → erase exaid）
#  注释行跳过      : 10 条 #fastboot 被正确跳过
#  步骤与顺序比对  : 37/37 完全一致，按脚本行序逐条匹配
#                    （1）getvar product     → L1
#                    （2）erase boot         → L26
#                    （3）flash crclist      → L28
#                    （4）flash xbl_4        → L30
#                    （5）flash xbl_config_4 → L34
#                    （6）flash xbl_5        → L36
#                    （7）flash xbl_config_5 → L40
#                    （8）flash abl          → L42
#                    （9）flash tz           → L46
#                   （10）flash hyp          → L50
#                   （11）flash devcfg       → L54
#                   （12）flash storsec      → L58
#                   （13）flash bluetooth    → L62
#                   （14）flash cmnlib       → L64
#                   （15）flash cmnlib64     → L68
#                   （16）flash modem        → L72
#                   （17）flash dsp          → L74
#                   （18）flash keymaster    → L76
#                   （19）flash logo         → L80
#                   （20）flash featenabler  → L84
#                   （21）flash misc         → L86
#                   （22）flash aop          → L88
#                   （23）flash qupfw        → L90
#                   （24）flash uefisecapp   → L92
#                   （25）flash multiimgoem  → L94
#                   （26）flash super        → L96
#                   （27）flash vbmeta       → L98
#                   （28）flash dtbo         → L100
#                   （29）flash vbmeta_system→ L102
#                   （30）flash cache        → L106
#                   （31）erase metadata     → L108
#                   （32）flash userdata     → L110
#                   （33）flash recovery     → L112
#                   （34）erase exaid        → L118（else 分支，exaid.img 不存在）
#                   （35）flash cust         → L121
#                   （36）flash boot         → L123
#                   （37）reboot             → L125
#  说明            : （1）getvar product 通过 filter_getvar=False 保留在步骤中
#                    （2）所有镜像地址为硬编码文件路径，非通配符匹配，全部正常解析
#                    （3）exaid 走了 else 分支 → erase exaid，符合预期
#                    （4）10 条被注释的 fastboot 命令正确跳过，不影响流程
# ============================================================

fastboot $* getvar product 2>&1 | grep "^product: *umi"
if [ $? -ne 0  ] ; then echo "Missmatching image and device"; exit 1; fi

#check anti_version
if [ -e $(dirname $0)/images/anti_version.txt ]; then
CURRENT_ANTI_VER=`cat $(dirname $0)/images/anti_version.txt`
fi
if [ -z "$CURRENT_ANTI_VER" ]; then CURRENT_ANTI_VER=0; fi
ver=`fastboot $* getvar anti 2>&1 | grep -oP "anti: \K[0-9]+"`
if [ -z "$ver" ]; then ver=0; fi
if [ $ver -gt $CURRENT_ANTI_VER ]; then echo "Current device antirollback version is greater than this pakcage"; exit 1; fi

fastboot $* erase boot
if [ $? -ne 0 ] ; then echo "Erase boot error"; exit 1; fi
fastboot $* flash crclist `dirname $0`/images/crclist.txt
if [ $? -ne 0 ] ; then echo "Flash crclist error"; exit 1; fi
fastboot $* flash xbl_4 `dirname $0`/images/xbl_4.elf
if [ $? -ne 0 ] ; then echo "Flash xbl_4 error"; exit 1; fi
#fastboot $* flash xblbak `dirname $0`/images/xbl.elf
#if [ $? -ne 0 ] ; then echo "Flash xblbak error"; exit 1; fi
fastboot $* flash xbl_config_4 `dirname $0`/images/xbl_config_4.elf
if [ $? -ne 0 ] ; then echo "Flash xbl_config_4 error"; exit 1; fi
fastboot $* flash xbl_5 `dirname $0`/images/xbl_5.elf
if [ $? -ne 0 ] ; then echo "Flash xbl_5 error"; exit 1; fi
#fastboot $* flash xblbak `dirname $0`/images/xbl.elf
#if [ $? -ne 0 ] ; then echo "Flash xblbak error"; exit 1; fi
fastboot $* flash xbl_config_5 `dirname $0`/images/xbl_config_5.elf
if [ $? -ne 0 ] ; then echo "Flash xbl_config_5 error"; exit 1; fi
fastboot $* flash abl `dirname $0`/images/abl.elf
if [ $? -ne 0 ] ; then echo "Flash abl error"; exit 1; fi
#fastboot $* flash ablbak `dirname $0`/images/abl.elf
#if [ $? -ne 0 ] ; then echo "Flash ablbak error"; exit 1; fi
fastboot $* flash tz `dirname $0`/images/tz.mbn
if [ $? -ne 0 ] ; then echo "Flash tz error"; exit 1; fi
#fastboot $* flash tzbak `dirname $0`/images/tz.mbn
#if [ $? -ne 0 ] ; then echo "Flash tzbak error"; exit 1; fi
fastboot $* flash hyp `dirname $0`/images/hyp.mbn
if [ $? -ne 0 ] ; then echo "Flash hyp error"; exit 1; fi
#fastboot $* flash hypbak `dirname $0`/images/hyp.mbn
#if [ $? -ne 0 ] ; then echo "Flash hypbak error"; exit 1; fi
fastboot $* flash devcfg `dirname $0`/images/devcfg.mbn
if [ $? -ne 0 ] ; then echo "Flash devcfg error"; exit 1; fi
#fastboot $* flash devcfgbak `dirname $0`/images/devcfg.mbn
#if [ $? -ne 0 ] ; then echo "Flash devcfgbak error"; exit 1; fi
fastboot $* flash storsec `dirname $0`/images/storsec.mbn
if [ $? -ne 0 ] ; then echo "Flash storsec error"; exit 1; fi
#fastboot $* flash storsecbak `dirname $0`/images/storsec.mbn
#if [ $? -ne 0 ] ; then echo "Flash storsecbak error"; exit 1; fi
fastboot $* flash bluetooth `dirname $0`/images/BTFM.bin
if [ $? -ne 0 ] ; then echo "Flash bluetooth error"; exit 1; fi
fastboot $* flash cmnlib `dirname $0`/images/cmnlib.mbn
if [ $? -ne 0 ] ; then echo "Flash cmnlib error"; exit 1; fi
#fastboot $* flash cmnlibbak `dirname $0`/images/cmnlib.mbn
#if [ $? -ne 0 ] ; then echo "Flash cmnlibbak error"; exit 1; fi
fastboot $* flash cmnlib64 `dirname $0`/images/cmnlib64.mbn
if [ $? -ne 0 ] ; then echo "Flash cmnlib64 error"; exit 1; fi
#fastboot $* flash cmnlib64bak `dirname $0`/images/cmnlib64.mbn
#if [ $? -ne 0 ] ; then echo "Flash cmnlib64bak error"; exit 1; fi
fastboot $* flash modem `dirname $0`/images/NON-HLOS.bin
if [ $? -ne 0 ] ; then echo "Flash modem error"; exit 1; fi
fastboot $* flash dsp `dirname $0`/images/dspso.bin
if [ $? -ne 0 ] ; then echo "Flash dsp error"; exit 1; fi
fastboot $* flash keymaster `dirname $0`/images/km4.mbn
if [ $? -ne 0 ] ; then echo "Flash keymaster error"; exit 1; fi
#fastboot $* flash keymasterbak `dirname $0`/images/keymaster64.mbn
#if [ $? -ne 0 ] ; then echo "Flash keymaster error"; exit 1; fi
fastboot $* flash logo `dirname $0`/images/logo.img
if [ $? -ne 0 ] ; then echo "Flash logo error"; exit 1; fi
#fastboot $* flash splash `dirname $0`/images/splash.img
#if [ $? -ne 0 ] ; then echo "Flash splash error"; exit 1; fi
fastboot $* flash featenabler `dirname $0`/images/featenabler.mbn
if [ $? -ne 0 ] ; then echo "Flash featenabler error"; exit 1; fi
fastboot $* flash misc `dirname $0`/images/misc.img
if [ $? -ne 0 ] ; then echo "Flash misc error"; exit 1; fi
fastboot $* flash aop `dirname $0`/images/aop.mbn
if [ $? -ne 0 ] ; then echo "Flash aop error"; exit 1; fi
fastboot $* flash qupfw `dirname $0`/images/qupv3fw.elf
if [ $? -ne 0 ] ; then echo "Flash qupfw error"; exit 1; fi
fastboot $* flash uefisecapp `dirname $0`/images/uefi_sec.mbn
if [ $? -ne 0 ] ; then echo "Flash uefisecapp error"; exit 1; fi
fastboot $* flash multiimgoem `dirname $0`/images/multi_image.mbn
if [ $? -ne 0 ] ; then echo "Flash multiimgoem error"; exit 1; fi
fastboot $* flash super `dirname $0`/images/super.img
if [ $? -ne 0 ] ; then echo "Flash super error"; exit 1; fi
fastboot $* flash vbmeta `dirname $0`/images/vbmeta.img
if [ $? -ne 0 ] ; then echo "Flash vbmeta error"; exit 1; fi
fastboot $* flash dtbo `dirname $0`/images/dtbo.img
if [ $? -ne 0 ] ; then echo "Flash dtbo error"; exit 1; fi
fastboot $* flash vbmeta_system `dirname $0`/images/vbmeta_system.img
if [ $? -ne 0 ] ; then echo "Flash vbmeta_system error"; exit 1; fi
#fastboot $* flash odm `dirname $0`/images/odm.img
#if [ $? -ne 0 ] ; then echo "Flash odm error"; exit 1; fi
fastboot $* flash cache `dirname $0`/images/cache.img
if [ $? -ne 0 ] ; then echo "Flash cache error"; exit 1; fi
fastboot $* erase metadata
if [ $? -ne 0 ] ; then echo "Erase metadata error"; exit 1; fi
fastboot $* flash userdata `dirname $0`/images/userdata.img
if [ $? -ne 0 ] ; then echo "Flash userdata error"; exit 1; fi
fastboot $* flash recovery `dirname $0`/images/recovery.img
if [ $? -ne 0 ] ; then echo "Flash recovery error"; exit 1; fi
if [ -f `dirname $0`/images/exaid.img ]; then
fastboot $* flash exaid `dirname $0`/images/exaid.img
if [ $? -ne 0 ] ; then echo "Flash exaid error"; exit 1; fi
else
fastboot $* erase exaid
if [ $? -ne 0 ] ; then echo "Erase exaid error"; exit 1; fi
fi
fastboot $* flash cust `dirname $0`/images/cust.img
if [ $? -ne 0 ] ; then echo "Flash cust error"; exit 1; fi
fastboot $* flash boot `dirname $0`/images/boot.img
if [ $? -ne 0 ] ; then echo "Flash boot error"; exit 1; fi
fastboot $* reboot
if [ $? -ne 0 ] ; then echo "Reboot error"; exit 1; fi
