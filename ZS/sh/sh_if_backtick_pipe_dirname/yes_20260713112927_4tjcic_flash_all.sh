fastboot $* getvar product 2>&1 | grep "^product: *elish"
if [ $? -ne 0  ] ; then echo "Missmatching image and device"; exit 1; fi

fastboot $* erase boot_a
if [ $? -ne 0 ] ; then echo "Erase boot_a error"; exit 1; fi
fastboot $* flash xbl_a `dirname $0`/images/xbl.elf
if [ $? -ne 0 ] ; then echo "Flash xbl_a error"; exit 1; fi
fastboot $* flash xbl_config_a `dirname $0`/images/xbl_config.elf
if [ $? -ne 0 ] ; then echo "Flash xbl_config_a error"; exit 1; fi
fastboot $* flash abl_a `dirname $0`/images/abl.elf
if [ $? -ne 0 ] ; then echo "Flash abl_a error"; exit 1; fi
fastboot $* flash tz_a `dirname $0`/images/tz.mbn
if [ $? -ne 0 ] ; then echo "Flash tz_a error"; exit 1; fi
fastboot $* flash hyp_a `dirname $0`/images/hyp.mbn
if [ $? -ne 0 ] ; then echo "Flash hyp_a error"; exit 1; fi
fastboot $* flash devcfg_a `dirname $0`/images/devcfg.mbn
if [ $? -ne 0 ] ; then echo "Flash devcfg_a error"; exit 1; fi
fastboot $* flash storsec `dirname $0`/images/storsec.mbn
if [ $? -ne 0 ] ; then echo "Flash storsec error"; exit 1; fi
fastboot $* flash bluetooth_a `dirname $0`/images/BTFM.bin
if [ $? -ne 0 ] ; then echo "Flash bluetooth_a error"; exit 1; fi
fastboot $* flash cmnlib_a `dirname $0`/images/cmnlib.mbn
if [ $? -ne 0 ] ; then echo "Flash cmnlib_a error"; exit 1; fi
fastboot $* flash cmnlib64_a `dirname $0`/images/cmnlib64.mbn
if [ $? -ne 0 ] ; then echo "Flash cmnlib64_a error"; exit 1; fi
fastboot $* flash modem_a `dirname $0`/images/NON-HLOS.bin
if [ $? -ne 0 ] ; then echo "Flash modem_a error"; exit 1; fi
fastboot $* flash dsp_a `dirname $0`/images/dspso.bin
if [ $? -ne 0 ] ; then echo "Flash dsp_a error"; exit 1; fi
fastboot $* flash keymaster_a `dirname $0`/images/km41.mbn
if [ $? -ne 0 ] ; then echo "Flash keymaster_a error"; exit 1; fi
fastboot $* flash featenabler_a `dirname $0`/images/featenabler.mbn
if [ $? -ne 0 ] ; then echo "Flash featenabler_a error"; exit 1; fi
fastboot $* flash aop_a `dirname $0`/images/aop.mbn
if [ $? -ne 0 ] ; then echo "Flash aop_a error"; exit 1; fi
fastboot $* flash qupfw_a `dirname $0`/images/qupv3fw.elf
if [ $? -ne 0 ] ; then echo "Flash qupfw_a error"; exit 1; fi
fastboot $* flash uefisecapp_a `dirname $0`/images/uefi_sec.mbn
if [ $? -ne 0 ] ; then echo "Flash uefisecapp_a error"; exit 1; fi
fastboot $* flash multiimgoem_a `dirname $0`/images/multi_image.mbn
if [ $? -ne 0 ] ; then echo "Flash multiimgoem_a error"; exit 1; fi
fastboot $* flash super `dirname $0`/images/super.img
if [ $? -ne 0 ] ; then echo "Flash super error"; exit 1; fi
fastboot $* flash misc `dirname $0`/images/misc.img
if [ $? -ne 0 ] ; then echo "Flash misc error"; exit 1; fi
fastboot $* --disable-verification --disable-verity flash vbmeta_a `dirname $0`/images/vbmeta.img
if [ $? -ne 0 ] ; then echo "Flash vbmeta_a error"; exit 1; fi
fastboot $* flash dtbo_a `dirname $0`/images/dtbo.img
if [ $? -ne 0 ] ; then echo "Flash dtbo_a error"; exit 1; fi
fastboot $* --disable-verification --disable-verity flash vbmeta_system_a `dirname $0`/images/vbmeta_system.img
if [ $? -ne 0 ] ; then echo "Flash vbmeta_system_a error"; exit 1; fi
fastboot $* erase metadata
if [ $? -ne 0 ] ; then echo "Erase metadata error"; exit 1; fi
fastboot $* flash userdata `dirname $0`/images/userdata.img
if [ $? -ne 0 ] ; then echo "Flash userdata error"; exit 1; fi
fastboot $* flash rescue `dirname $0`/images/rescue.img
if [ $? -ne 0 ] ; then echo "Flash rescue error"; exit 1; fi
fastboot $* erase cust
if [ $? -ne 0 ] ; then echo "Erase cust error"; exit 1; fi
fastboot $* erase imagefv_a
fastboot $* flash imagefv_a `dirname $0`/images/imagefv.elf
if [ $? -ne 0 ] ; then echo "Flash imagefv_a error"; exit 1; fi
fastboot $* flash spunvm `dirname $0`/images/spunvm.bin
if [ $? -ne 0 ] ; then echo "Flash spunvm error"; exit 1; fi
fastboot $* flash vendor_boot_a `dirname $0`/images/vendor_boot.img
if [ $? -ne 0 ] ; then echo "Flash vendor_boot_a error"; exit 1; fi
fastboot $* flash logfs `dirname $0`/images/logfs_ufs_8mb.bin
if [ $? -ne 0 ] ; then echo "Flash logfs error"; exit 1; fi
fastboot $* flash boot_a `dirname $0`/images/boot.img
if [ $? -ne 0 ] ; then echo "Flash boot_a error"; exit 1; fi
fastboot $* set_active a
if [ $? -ne 0 ] ; then echo "set_active a error"; exit 1; fi
fastboot $* reboot
if [ $? -ne 0 ] ; then echo "Reboot error"; exit 1; fi

