/* global $, Dropzone, io */

(function () {
    "use strict";

    var folderList = [], isUploading = false, currentFolder = "/", socketOpen = false;
    var bar, info, nameinput, percent, progress, start, socket;

/* ============================================================================
 *  Page loading functions
 * ============================================================================
 */

// Initialize webshims lib
    $.webshims.setOptions("basePath", "res/webshim/shims/");

    $.webshims.polyfill();

    function getPage() {
        $.getJSON('/content', function (response) {
            animatedLoad("page", "body", response.data, function () {
                // Load the appropriate Javascript for the received page
                switch (response.type) {
                case "main":
                    initMainPage();
                    break;
                case "auth":
                    initAuthPage();
                    break;
                }
            });
        });
    }

// Switch an element's content with an animation
    function animatedLoad(oldElement, container, data, callback) {
        $(container).css("overflow", "hidden");
        $(container).appendPolyfill('<div id="new">' + data + '</div>');
        var newElement = $("#new");
        newElement.css("opacity", 0);
        newElement.animate({
            "opacity" : 1
        }, {
            duration: 400,
            queue: false,
            complete: function () {
                $(container).css("overflow", "visible");
                $("#" + oldElement).remove();
                newElement.attr("id", oldElement);
                callback();
            }
        });
        $("#" + oldElement).animate({
            "opacity" : 0
        }, {
            duration: 400,
            queue: false
        });
    }

    $(getPage);
/* ============================================================================
 *  WebSocket functions
 * ============================================================================
 */
    function openSocket() {
        if (socketOpen === "true") return;
        socket = io.connect(document.location.protocol + "//" + document.location.host);

        socket.on("connect", function () {
            socketOpen = true;
            // Request initial update
            sendMessage("REQUEST_UPDATE", currentFolder);

            // Close the socket to prevent Firefox errors
            $(window).on('beforeunload', function () {
                socket.disconnect();
                socketOpen = false;
            });
        });

        socket.on("UPDATE_FILES", function (data) {
            var msgData = JSON.parse(data);
            if (isUploading) return;
            if (msgData.folder === currentFolder.replace(/&amp;/, "&")) {
                updateCrumbs(msgData.folder);
                $("#content").htmlPolyfill(buildHTML(msgData.data, msgData.folder));
            }
        });

        socket.on("disconnect", function () {
            socketOpen = false;

            // Restart a closed socket. Firefox closes it on every download..
            // https://bugzilla.mozilla.org/show_bug.cgi?id=858538
            setTimeout(function () {
                socket.socket.connect();
            }, 50);
        });

        socket.on("error", function (error) {
            if (typeof error === "object" && Object.keys(error).length > 0)
                console.log(JSON.stringify(error, null, 4));
            else if (typeof error === "string" && error !== "")
                console.log(error);
        });
    }

    function sendMessage(msgType, msgData) {
        if (!socketOpen) return;
        socket.emit(msgType, JSON.stringify(msgData));
    }
/* ============================================================================
 *  Authentication page JS
 * ============================================================================
 */
    function initAuthPage() {
        var user   = $("#user"),
            pass   = $("#pass"),
            form   = $("form"),
            submit = $("#submit"),
            remember = $("#below");

        user.focus();

        // Return submits the form
        pass.keyup(function (e) {
            if (e.keyCode === 13) {
                submitForm(form, submit);
            }
        });

        // Spacebar toggles the checkbox
        remember.keyup(function (e) {
            if (e.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        submit.click(function () {
            submitForm(form, submit);
        });

        user.focus(function () {
            resetError(submit);
        });

        pass.focus(function () {
            resetError(submit);
        });

        function submitForm(form, errForm) {
            $.ajax({
                type: "POST",
                url: "/login",
                data: form.serialize(),
                success: function (data) {
                    if (data === "OK")
                        getPage();
                    else
                        showError(errForm);
                }
            });
        }

        function showError(element) {
            element.attr("class", "invalid");
            element.val("Wrong username/password!");
        }

        function resetError(element) {
            element.attr("class", "valid");
            element.val("Sign in");
        }
    }
/* ============================================================================
 *  Main page JS
 * ============================================================================
 */

    function initMainPage() {
        openSocket();

        // Cache elements
        bar = $("#progressBar"),
        info = $("#info"),
        nameinput = $("#nameinput"),
        percent = $("#percent"),
        progress = $("#progress"),

        // Initialize and attach plugins
        attachDropzone();
        attachForm();

        // Switch into a folder
        $("body").on("click", ".folderlink", function (e) {
            e.preventDefault();

            var destination = $(this).html();
            if (currentFolder !== "/") destination = "/" + destination;
            currentFolder += destination;
            sendMessage("SWITCH_FOLDER", currentFolder);
        });

        // Jump to a folder using the breadcrumbs
        $("body").on("click", ".navlink", function (e) {
            e.preventDefault();
            var destination = $(this).data("path");
            currentFolder = destination;
            sendMessage("SWITCH_FOLDER", currentFolder);
        });

        // Go back up
        $("body").on("click", ".backlink", function (e) {
            e.preventDefault();

            var match = currentFolder.match(/.*(\/)/)[0];
            match = match.substring(0, match.length - 1);
            if (!match.match(/\//)) match = "/";
            currentFolder = match;
            sendMessage("SWITCH_FOLDER", currentFolder);
        });

        // Delete a file/folder
        $("body").on("click", ".delete", function (e) {
            e.preventDefault();
            sendMessage("DELETE_FILE", $(this).parents().eq(2).data("id") || $(this).parents().eq(1).data("id"));
        });

        // Automatically submit a form once it's data changed
        $("form").change(function () {
            $("form").submit();
            $("#file").val(""); // Reset file form
        });

        // Show popup for folder creation
        $("#add-folder").click(function () {
            $("#overlay").fadeToggle(350);
            nameinput.val("");
            nameinput.focus();
            nameinput.attr("class", "valid");
        });

        // Handler for the input of the folder name
        nameinput.keyup(function (e) {
            if (e.keyCode === 27) // Escape Key
                $("#overlay").toggle();

            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists = folderList[input.toLowerCase()] === true;
            if (input === "") {
                nameinput.attr("class", "valid");
                info.htmlPolyfill("&nbsp;");
                return;
            }

            if (!valid) {
                nameinput.attr("class", "invalid");
                info.htmlPolyfill("Invalid character(s) in filename!");
                return;
            }

            if (folderExists) {
                nameinput.attr("class", "invalid");
                info.htmlPolyfill("File/Directory already exists!");
                return;
            }

            nameinput.attr("class", "valid");
            info.htmlPolyfill("&nbsp;");

            if (e.keyCode === 13) { // Return Key
                if (currentFolder === "/")
                    sendMessage("CREATE_FOLDER", "/" + input);
                else
                    sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
                $("#overlay").fadeOut(350);
            }
        });
        /* ============================================================================
         *  Helper functions for the main page
         * ============================================================================
         */
        function attachDropzone() {
            var dropZone = new Dropzone(document.body, {
                clickable: false,
                url: "/upload",
                previewsContainer: "#preview",
                parallelUploads: 1000,
                maxFilesize: 65535
            });

            //dropZone.on("sending", function () {
           //     uploadInit();
         //   });

            dropZone.on("uploadprogress", function (file, progress, bytesSent) {
                uploadProgress(bytesSent, file.size, progress);
            });

            dropZone.on("complete", function () {
                uploadDone();
            });
        }
        function attachForm() {
            $("form").ajaxForm({
                beforeSend: function () {
                    uploadInit();
                },
                uploadProgress: function (e, bytesSent, bytesTotal, completed) {
                    uploadProgress(bytesSent, bytesTotal, completed);
                },
                complete: function () {
                    uploadDone();
                }
            });
        }
        function uploadInit() {
            bar.width("0%");
            percent.htmlPolyfill("");
            progress.fadeIn(300);
            isUploading = true;
            start = new Date().getTime();
        }
        function uploadDone() {
            bar.width("100%");
            percent.htmlPolyfill("finished");
            progress.fadeOut(300);
            isUploading = false;
        }
        function uploadProgress(bytesSent, bytesTotal, completed) {
            var perc = Math.round(completed) + "%";
            bar.width(perc);

            // Calculate estimated time left
            var elapsed = (new Date().getTime()) - start;
            var estimate = bytesTotal / (bytesSent / elapsed);
            var secs = (estimate - elapsed) / 1000;
            if (secs > 120) {
                percent.htmlPolyfill("less than " + Math.floor((secs / 60) + 1) + " minutes left");
            } else if (secs > 60) {
                percent.htmlPolyfill("less than 2 minute left");
            } else {
                percent.htmlPolyfill(Math.round(secs) + " seconds left");
            }
        }
    }
/* ============================================================================
 *  General helpers
 * ============================================================================
 */
    function updateCrumbs(path) {
        document.title = ["droppy", path].join(" - ");
        var parts = path.split("/");
        parts[0] = "droppy";

        // Remove trailing empty string
        if (parts[parts.length - 1] === "") parts.pop();

        // Build the list
        var html = '<ul id="crumbs">';
        var elementPath = "";

        for (var i = 0, len = parts.length; i < len; i++) {
            if (parts[i] === "droppy") {
                html += ['<li><a class="navlink" data-path="/" href="">', parts[i], '</a></li>'].join("");
            } else {
                elementPath += "/" + parts[i];
                html += ['<li><a class="navlink" data-path="', elementPath, '" href="">', parts[i], '</a></li>'].join("");
            }
        }

        html += '</ul>';

        var oldLen = $("#current ul li").length;
        $("#current").htmlPolyfill(html);
        if ($("#current ul li").length > oldLen) {
            var last = $("#current ul li:last-child");
            last.css("margin-top", -100);
            last.css("opacity", 0);
            $("#current ul li:last-child").animate({
                "margin-top" : 0,
                "opacity" : 1
            }, {
                duration: 250
            });
        }

    }

    function buildHTML(fileList, root) {
        // TODO: Clean up this mess
        var htmlFiles = "", htmlDirs = "", htmlBack = "", folderList = [];

        if (root !== "/") {
            htmlBack = [
                '<div class="folderrow">',
                '<img class="icon" src="res/dir.png" width="16px" height="16px" alt="Go back up">',
                '<a class="backlink" href="">..</a></div><div class="right"></div>'
            ].join("");
        }

        for (var file in fileList) {
            if (fileList.hasOwnProperty(file)) {

                var name = file;
                var type = fileList[file].type;
                var size = convertToSI(fileList[file].size);

                var id;
                if (root === "/")
                    id = "/" + name;
                else
                    id = root + "/" + name;

                if (type === "f") {
                    //Create a file row
                    htmlFiles += [
                        '<div class="filerow" data-id="', id, '"><img class="icon" src="res/file.png" width="16" height="16" alt="File" />',
                        '<div class="filename"><a class="filelink" href="', escape("/get" + id), '">', name, '</a></div>',
                        '<div class="fileinfo"><span class="pin-right">', size, '<span class="spacer"></span><a class="delete" href="">&#x2716;</a></div>',
                        '<div class="right"></div></div>'
                    ].join("");

                } else if (type === "d") {
                    //Create a folder row
                    htmlDirs += [
                        '<div class="folderrow" data-id="', id, '"><img class="icon" src="res/dir.png" width="16" height="16" alt="Directory" />',
                        '<div class="foldername"><a class="folderlink" href="">', name, '</a></div>',
                        '<div class="folderinfo"><span class="spacer"></span><a class="delete" href="">&#x2716;</a></div>',
                        '<div class="right"></div></div>'
                    ].join("");

                    //Add to list of active folders
                    folderList[name.toLowerCase()] = true;
                }

            }
        }
        return htmlBack + htmlDirs + htmlFiles;
    }

    function convertToSI(bytes) {
        var kib = 1024,
            mib = kib * 1024,
            gib = mib * 1024,
            tib = gib * 1024;

        if ((bytes >= 0) && (bytes < kib))         return bytes + ' Bytes';
        else if ((bytes >= kib) && (bytes < mib))  return (bytes / kib).toFixed(2) + ' KiB';
        else if ((bytes >= mib) && (bytes < gib))  return (bytes / mib).toFixed(2) + ' MiB';
        else if ((bytes >= gib) && (bytes < tib))  return (bytes / gib).toFixed(2) + ' GiB';
        else if (bytes >= tib)                     return (bytes / tib).toFixed(2) + ' TiB';
        else return bytes + ' Bytes';
    }

}).call(this);
