if [ -e $(dirname $0)/images/anti_version.txt ]; then
CURRENT_ANTI_VER=`cat $(dirname $0)/images/anti_version.txt`
fi
if [ -z "$CURRENT_ANTI_VER" ]; then CURRENT_ANTI_VER=0; fi
ver=`fastboot $* getvar anti 2>&1 | grep -oP "anti: \K[0-9]+"`
if [ -z "$ver" ]; then ver=0; fi
if [ $ver -gt $CURRENT_ANTI_VER ]; then echo "Current device antirollback version is greater than this pakcage"; exit 1; fi
fastboot $* getvar product 2>&1 | grep "chopin"
if [ $? -ne 0 ] ; then echo "Missmatching image and device"; exit 1; fi
SCRIPT_PATH=$(dirname $0)
handle_error(){
    echo $@
    exit 2;
}
fastboot $* getvar crc 2>&1 | grep "^crc: 1"
if [ $? -eq 0 ]; then
fastboot $* flash crclist       ${SCRIPT_PATH}/images/crclist.txt       || handle_error flash crclist error
fastboot $* flash sparsecrclist ${SCRIPT_PATH}/images/sparsecrclist.txt || handle_error flash sparsecrclist error
fi

fastboot $* erase boot_ab      || handle_error erase boot error
fastboot $* erase expdb     || handle_error erase expdb error
fastboot $* erase metadata  || handle_error erase metadata error
fastboot $* flash preloader_ab ${SCRIPT_PATH}/images/preloader_chopin.bin  || handle_error flash preloader error
fastboot $* flash lk_ab       ${SCRIPT_PATH}/images/lk.img         || handle_error flash lk_b error
fastboot $* flash dpm_ab     ${SCRIPT_PATH}/images/dpm.img        || handle_error flash dpm error
fastboot $* flash tee_ab     ${SCRIPT_PATH}/images/tee.img        || handle_error flash tee_a error
fastboot $* flash mitee_ab   ${SCRIPT_PATH}/images/mitee.img      || handle_error flash mitee1 error
fastboot $* flash sspm_ab    ${SCRIPT_PATH}/images/sspm.img       || handle_error flash sspm_a error
fastboot $* flash gz_ab       ${SCRIPT_PATH}/images/gz.img         || handle_error flash gz_a error
fastboot $* flash scp_ab      ${SCRIPT_PATH}/images/scp.img        || handle_error flash scp_a error
fastboot $* flash logo      ${SCRIPT_PATH}/images/logo.bin       || handle_error flash logo error
fastboot $* flash dtbo_ab      ${SCRIPT_PATH}/images/dtbo.img       || handle_error flash dtbo error
fastboot $* flash spmfw_ab     ${SCRIPT_PATH}/images/spmfw.img      || handle_error flash spmfw error
fastboot $* flash mcupm_ab   ${SCRIPT_PATH}/images/mcupm.img      || handle_error flash mcupm error
fastboot $* flash pi_img_ab    ${SCRIPT_PATH}/images/pi_img.img     || handle_error flash pi_img error
#fastboot $* flash oem_misc1 ${SCRIPT_PATH}/images/oem_misc1.img  || handle_error flash oem_misc1 error
fastboot $* flash md1img_ab    ${SCRIPT_PATH}/images/md1img.img     || handle_error flash md1img error
fastboot $* flash cam_vpu1_ab  ${SCRIPT_PATH}/images/cam_vpu1.img   || handle_error flash cam_vpu1 error
fastboot $* flash cam_vpu2_ab  ${SCRIPT_PATH}/images/cam_vpu2.img   || handle_error flash cam_vpu2 error
fastboot $* flash cam_vpu3_ab  ${SCRIPT_PATH}/images/cam_vpu3.img   || handle_error flash cam_vpu3 error
fastboot $* flash audio_dsp_ab ${SCRIPT_PATH}/images/audio_dsp.img  || handle_error flash audio_dsp error

fastboot $* flash super         ${SCRIPT_PATH}/images/super.img           || handle_error flash super error
fastboot $* flash rescue        ${SCRIPT_PATH}/images/rescue.img          || handle_error flash rescue error
#fastboot $* flash cache         ${SCRIPT_PATH}/images/cache.img           || handle_error flash cache error
#fastboot $* flash recovery      ${SCRIPT_PATH}/images/recovery.img        || handle_error flash recovery error
#fastboot $* flash cust          ${SCRIPT_PATH}/images/cust.img            || handle_error flash cust error
fastboot $* flash vbmeta_ab        ${SCRIPT_PATH}/images/vbmeta.img          || handle_error flash vbmeta error
fastboot $* flash vbmeta_system_ab ${SCRIPT_PATH}/images/vbmeta_system.img   || handle_error flash vbmeta_system error
fastboot $* flash vbmeta_vendor_ab ${SCRIPT_PATH}/images/vbmeta_vendor.img   || handle_error flash vbmeta_vendor error
fastboot $* flash cust      	${SCRIPT_PATH}/images/cust.img        		|| handle_error flash cust error
fastboot $* flash userdata      ${SCRIPT_PATH}/images/userdata.img        || handle_error flash userdata error
fastboot $* flash boot_ab          ${SCRIPT_PATH}/images/boot.img            || handle_error flash boot error
fastboot $* oem cdms
fastboot $* set_active a  || handle_error set_active a error
fastboot $* reboot
if [ $? -ne 0 ] ; then echo "Reboot error"; exit 1; fi
exit 0

